/** Runtime flags. Dev-only surfaces (fixtures, showcase route) must check these on the server. */
export const isProduction = process.env.NODE_ENV === "production";
export const isDevelopment = !isProduction;
