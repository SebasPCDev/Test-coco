import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  DataSource,
  FindOptionsOrderValue,
  FindOptionsWhere,
  Repository,
} from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { UUID } from 'crypto';

import { CreateEmployeeDto, CreateUsersDto, UpdateUsersDto } from '../users/users.dto';
import { CreateCompaniesDto, UpdateCompaniesDto } from './companies.dto';
import { NodemailerService } from '../nodemailer/nodemailer.service';
import { Companies } from 'src/entities/companies.entity';
import { Employees } from 'src/entities/employees.entity';
import { Request } from 'src/entities/requests.entity';
import { Users } from 'src/entities/users.entity';
import { loadDataCompanies } from 'src/utils/loadData';
import { UserStatus } from 'src/models/userStatus.enum';
import { StatusRequest } from 'src/models/statusRequest.enum';
import { CompanyStatus } from 'src/models/companyStatus.enum';
import { Role } from 'src/models/roles.enum';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Companies)
    private companiesRepository: Repository<Companies>,
    @InjectRepository(Request)
    private requestsRepository: Repository<Request>,
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
    @InjectRepository(Employees)
    private employeesRepository: Repository<Employees>,
    private dataSource: DataSource,
    private readonly nodemailerService: NodemailerService,
  ) { }

  async getAllCompanies(
    status: CompanyStatus,
    name: string,
    page: number,
    limit: number,
  ) {
    const where: FindOptionsWhere<Companies> = {};

    if (status) where.status = status;
    if (name) where.name = name;

    const skip = (page - 1) * limit;

    const conditions = {
      skip: skip,
      take: limit,
      where,
      order: { updatedAt: 'DESC' as FindOptionsOrderValue },
    };
    const [companies, total] =
      await this.companiesRepository.findAndCount(conditions);

    return { page, limit, total, companies };
  }

  async getCompanyById(id: UUID) {
    const company = await this.companiesRepository.findOne({
      where: { id },
      relations: ['employees', 'employees.user'],
    });

    if (!company) throw new BadRequestException('Empresa no encontrada');
    return company;
  }

  create(data: CreateCompaniesDto) {
    console.log('data', data);
    return 'Esta acción añade una nueva empresa.';
  }

  async activateCompany(id: UUID) {
    // 1- Busco la solicitud
    const request = await this.requestsRepository.findOneBy({ id });
    if (!request || request.status === StatusRequest.CLOSE)
      throw new BadRequestException('solicitud procesada o inexistente');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.startTransaction(); // START

      const user = await this.usersRepository.findOneBy({
        email: request.email,
      });
      if (user) throw new BadRequestException('Usuario existente');

      // 2- Crear user
      // const password = Math.random().toString(36).slice(-8);
      const password = process.env.SUPERADMIN_PASSWORD;
      const hashedPass = await bcrypt.hash(password, 10);
      if (!hashedPass)
        throw new BadRequestException('No se pudo aplicar hash a la contraseña');

      const userData: CreateUsersDto = {
        name: request.name,
        lastname: request.lastname,
        phone: request.phone,
        email: request.email,
        password: hashedPass,
        identification: "",
        position: request.position,
        status: UserStatus.ACTIVE,
        role: Role.ADMIN_COMPANY,
      };

      const newUserTemp = this.usersRepository.create(userData);
      const newUser = await queryRunner.manager.save(newUserTemp);

      const company: CreateCompaniesDto = {
        name: request.companyName,
        phone: request.phone,
        email: request.email,
        quantityBeneficiaries: 0,
        businessSector: '',
        size: request.size,
        status: CompanyStatus.ACEPTED,
        totalPasses: 0,
      };

      const newCompanyTemp = this.companiesRepository.create(company);
      const newCompany = await queryRunner.manager.save(newCompanyTemp);

      // Create Employee
      const employee = {
        passes: 1,
        passesAvailable: 1,
        user: newUser,
        company: newCompany,
      };

      const newEmployee = this.employeesRepository.create(employee);
      await queryRunner.manager.save(newEmployee);

      // 3- Requests pending -> close
      const updRequest = this.requestsRepository.merge(request, {
        status: StatusRequest.CLOSE,
      });

      await queryRunner.manager.save(updRequest);

      // 4- Enviar email
      this.nodemailerService.confirmacionMailRequest(
        request.email,
        request.companyName,
        password,
      );

      await queryRunner.commitTransaction(); //COMMIT
      await queryRunner.release(); // RELEASE

      return newCompany;
    } catch (err) {
      await queryRunner.rollbackTransaction(); // ROLLBACK
      await queryRunner.release(); // RELEASE
      throw err;
    }
  }

  async createEmployee(adminCompanyId: UUID, data: CreateEmployeeDto) {
    const dbUser = await this.usersRepository.findOneBy({
      email: data.email,
    });
    if (dbUser) throw new BadRequestException('Usuario no encontrado');

    const adminCompany = await this.usersRepository.findOne({
      where: { id: adminCompanyId },
      relations: ['employee.company'],
    });

    if (adminCompany.employee.company.id !== data.companyId)
      throw new ForbiddenException(
        'No tienes permiso y no puedes acceder a esta ruta',
      );

    const company = await this.companiesRepository.findOneBy({
      id: data.companyId,
    });
    if (!company) throw new BadRequestException('Empresa no encontrada');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      await queryRunner.startTransaction(); // START

      const password = process.env.SUPERADMIN_PASSWORD;
      const hashedPass = await bcrypt.hash(password, 10);
      if (!hashedPass)
        throw new BadRequestException('Contraseña no haseada');

      data.password = hashedPass;
      data.role = Role.EMPLOYEE;
      const user = this.usersRepository.create(data);
      const newUser = await queryRunner.manager.save(user);

      const employee = {
        passes: data.passes,
        passesAvailable: data.passesAvailable,
        user: newUser,
        company,
      };

      const newEmployee = this.employeesRepository.create(employee);
      await queryRunner.manager.save(newEmployee);

      await queryRunner.commitTransaction(); //COMMIT
      await queryRunner.release(); // RELEASE

      return await this.usersRepository.findOneBy({
        email: data.email,
      });
    } catch (err) {
      await queryRunner.rollbackTransaction(); // ROLLBACK
      await queryRunner.release(); // RELEASE
      throw err;
    }
  }

  async updateUser(adminCompany: Users, companyId: UUID, userId: UUID, changes: UpdateUsersDto) {
    
    // Validamos que el adminCompany y el employyee pertenezcan a la misma compañía 
    const {employees} = await this.getCompanyById(companyId);
        
    const foundAdminCompany = employees.findIndex((employee) => employee.user.id === adminCompany.id);
    if (foundAdminCompany === -1) throw new ForbiddenException('No tienes permiso para acceder a esta ruta');

    const foundEmployee = employees.findIndex((employee) => employee.user.id === userId);
    if (foundEmployee === -1) throw new ForbiddenException('No tienes permiso para acceder a esta ruta');

    const dbUser = await this.usersRepository.findOneBy({id: userId});
    const updUser = this.usersRepository.merge(dbUser, changes);

    return await this.usersRepository.save(updUser);
  }

  async update(id: UUID, changes: UpdateCompaniesDto) {
    const company = await this.getCompanyById(id);

    const updCompany = this.companiesRepository.merge(company, changes);
    return this.companiesRepository.save(updCompany);
  }

 async preloadCompanies() {
    const data = loadDataCompanies();

    for await (const company of data) {
      const companyExists = await this.companiesRepository.findOne({
        where: { email: company.email },
      });

      if (!companyExists) {
        await this.companiesRepository.save(company);
      }
    }
    console.log(`
    ###############################################
    ##### Companies data loaded successfully #####
    ###############################################

    `);
    return true;
  }
}
