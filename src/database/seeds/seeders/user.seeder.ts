/**
 * This project uses environment-based authentication (no users table).
 * Credentials are stored in AUTH_USERNAME / AUTH_PASSWORD env vars and
 * validated at runtime by AuthService — there is nothing to seed in the DB.
 *
 * This seeder surfaces the configured credentials so developers can verify
 * their local setup without hunting through .env files.
 */
export class UserSeeder {
  run(): void {
    const username = process.env.AUTH_USERNAME ?? '(not set)';
    const passwordSet = process.env.AUTH_PASSWORD ? 'set' : '(not set)';

    console.log(
      '  [UserSeeder] Auth is environment-based — no users table to seed.',
    );
    console.log(
      `  [UserSeeder] Configured user: "${username}" / password: ${passwordSet}`,
    );
  }
}
