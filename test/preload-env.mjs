/** Ensures module imports that touch Prisma can load without a live database. */
process.env.DATABASE_URL ??= 'postgresql://pishock:pishock@127.0.0.1:5432/pishock_test';
