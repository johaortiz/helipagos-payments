import 'dotenv/config';
import { DataSource } from 'typeorm';

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
