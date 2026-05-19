import { config } from 'dotenv';
import { DataSource } from 'typeorm';

// Load env-specific file first so its values take precedence, then fall back
// to .env for any variables not present in the env-specific file.
// dotenv.config() never overwrites variables already set in process.env,
// so Docker-injected values are always respected.
config({ path: `.env.${process.env.NODE_ENV ?? 'development'}` });
config({ path: '.env' });

import { PaymentOrmEntity } from '../contexts/payments/infrastructure/persistence/entities/payment.orm-entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [PaymentOrmEntity],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
});
