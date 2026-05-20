import { validateRequiredEnv } from '@nexora/shared';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    validateRequiredEnv();
  }

  const port = Number(process.env.PORT || 3000);
  console.log(`NEXORA API foundation ready on port ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
