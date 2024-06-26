const redirectionByRole = (role: string) => {
  if (role === "superadmin") {
    return "/superadminsup";
  } else if (role === "adminCoworking") {
    return "/adminCoworking";
  } else if (role === "adminCompany") {
    return "/adminCompany";
  } else {
    return "/";
  }
};

export default redirectionByRole;
