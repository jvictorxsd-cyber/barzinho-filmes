export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '0.0.0.0',
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  production: process.env.NODE_ENV === 'production',
};
export function problem(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), {statusCode});
}
