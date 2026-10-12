import "dotenv/config";
import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()),
  });

  // Loopback only: the database holds personal data and the API can start a
  // real reservation, so it must not be reachable from the network.
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, host);
  new Logger("Bootstrap").log(`API listening on http://${host}:${port}`);
}

void bootstrap();
