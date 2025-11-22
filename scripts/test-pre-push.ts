import { execSync } from 'child_process';
import { logger } from '../src/utils/logger';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.test') });

logger.info("Syncing Prisma schema to test database...");

execSync("npx prisma db push --force-reset --skip-generate", {
  stdio: 'inherit',
});

logger.info("Test database is ready!");
