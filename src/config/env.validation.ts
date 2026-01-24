import { z } from 'zod';

export const envSchema = z.object({
    NODE_ENV: z
        .enum(['development', 'production', 'test'])
        .default('development'),
    PORT: z.coerce.number().default(3000),
    API_PREFIX: z.string().default('api/v1'),

    DATABASE_URL: z.string().min(1, 'Database URL is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'Access secret must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'Refresh secret must be at least 32 characters'),
    JWT_ACCESS_EXPIRATION: z.string().default('15m'),
    JWT_REFRESH_EXPIRATION: z.string().default('7d'),

    COOKIE_SECRET: z.string().min(32, 'Cookie secret must be at least 32 characters'),
    COOKIE_DOMAIN: z.string().default('localhost'),
    COOKIE_SECURE: z.coerce.boolean().default(false),
    COOKIE_SAME_SITE: z
        .enum(['lax', 'strict', 'none'])
        .default('lax'),

    CORS_ORIGIN: z.string().url().default('http://localhost:3001'),

    THROTTLE_TTL: z.coerce.number().default(60),
    THROTTLE_LIMIT: z.coerce.number().default(10),

    DEMO_EMAIL: z.string().email().optional(),
    DEMO_PASSWORD: z.string().optional(),
});

export type Environment = z.infer<typeof envSchema>;

export const envValidation = (config: Record<string, unknown>) => {
    return envSchema.parse(config);
};