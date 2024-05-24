import { BadRequestException, Injectable } from '@nestjs/common';

import { UUID } from 'crypto';
import { CreateBookingsDto, UpdateBookingsDto } from './bookings.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from 'src/entities/users.entity';
import { Repository } from 'typeorm';
import { Coworkings } from 'src/entities/coworkings.entity';
import { Bookings } from 'src/entities/bookings.entity';
import { timeToMinutes } from 'src/helpers/timeToMinutes';
import { NodemailerService } from '../nodemailer/nodemailer.service';
// import { Role } from 'src/models/roles.enum';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
    @InjectRepository(Coworkings)
    private coworkingsRepository: Repository<Coworkings>,
    @InjectRepository(Bookings)
    private bookingsRepository: Repository<Bookings>,
    private readonly nodemailerService: NodemailerService,
  ) { }

  async findAll() {
    const bookings = await this.bookingsRepository.find()
    return bookings
  }

  async findOne(id: UUID) {
    const booking = await this.bookingsRepository.findOne({ where: { id }, relations: ['user', 'coworking'] })
    if (!booking) throw new BadRequestException('Reserva no encontrada');
    return booking;
  }

  async create(userId: UUID, data: CreateBookingsDto) {

    const user = await this.usersRepository.findOneBy({ id: userId })
    if (!user) throw new BadRequestException('Usuario no encontrado');

    const coworking = await this.coworkingsRepository.findOneBy({ id: data.coworkingId })
    if (!coworking) throw new BadRequestException('Coworking no encontrado');

    const openTimeMinutes = timeToMinutes(coworking.open);
    const closeTimeMinutes = timeToMinutes(coworking.close);
    const reservationTimeMinutes = timeToMinutes(data.reservationTime);

    // Comparar las horas en minutos
    if (reservationTimeMinutes < openTimeMinutes || reservationTimeMinutes > closeTimeMinutes) {
      throw new BadRequestException('La hora de reserva es antes de la apertura o después del cierre del coworking.');
    }


    const newData = { ...data, user, coworking }

    const newBooking = this.bookingsRepository.create(newData)
    const booking = await this.bookingsRepository.save(newBooking)
    //! mail  a user  info: reserva pendieynte de confirmacion (nombre direccion dia y hora)
    this.nodemailerService.NotificationBookingEmployee(
      coworking.name,
      user.name,
      user.email,
      booking.reservationDate,
      booking.reservationTime,
      coworking.address
    )
    //! mail a  coworking info quieren reservar dia horario (user apellido dni date hora )
    this.nodemailerService.NotificationBookingCoworking(
      coworking.name,
      user.name,
      user.lastname,
      booking.reservationDate,
      booking.reservationTime,
      coworking.email
    )


    return booking;
  }

  async update(id: UUID, changes: UpdateBookingsDto) {
    const booking = await this.findOne(id);

    const updBooking = this.bookingsRepository.merge(booking, changes);
    return await this.bookingsRepository.save(updBooking);
  }
}
