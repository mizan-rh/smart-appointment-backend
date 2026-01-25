import { neon } from '@neondatabase/serverless';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseService implements OnModuleInit {
    private sql: any;

    constructor(private configService: ConfigService) {
        const databaseUrl = this.configService.getOrThrow<string>('DATABASE_URL');
        this.sql = neon(databaseUrl);
    }

    async onModuleInit() {
        // Test connection
        try {
            await this.sql`SELECT 1`;
        } catch (error) {
            console.error('Failed to connect to Neon DB:', error);
            throw error;
        }
    }

    get raw() {
        return this.sql;
    }

    async query<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
        return this.sql(strings, ...values);
    }
}
