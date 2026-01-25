import { neon } from '@neondatabase/serverless';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import { join } from 'path';

// Load environment variables from .env file
dotenv.config({ path: join(process.cwd(), '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.error('DATABASE_URL is not defined in .env');
    process.exit(1);
}

const sql = neon(databaseUrl);

async function seed() {
    console.log('🌱 Starting database seeding...');

    try {
        // 1. Clear existing data (optional, but good for a clean seed)
        console.log('Cleaning up existing data...');
        await sql`DELETE FROM activity_logs`;
        await sql`DELETE FROM queue_entries`;
        await sql`DELETE FROM appointments`;
        await sql`DELETE FROM services`;
        await sql`DELETE FROM staff`;
        await sql`DELETE FROM refresh_tokens`;
        await sql`DELETE FROM users`;

        // 2. Create Demo User
        const demoEmail = process.env.DEMO_EMAIL || 'demo@example.com';
        const demoPassword = process.env.DEMO_PASSWORD || 'Demo@123456';
        const hashedDemoPassword = await bcrypt.hash(demoPassword, 10);
        const demoUserId = randomUUID();

        console.log(`Creating demo user: ${demoEmail}`);
        await sql`
      INSERT INTO users (id, email, password, first_name, last_name, updated_at)
      VALUES (${demoUserId}, ${demoEmail}, ${hashedDemoPassword}, 'Demo', 'User', NOW())
    `;

        // 3. Create Staff Members
        console.log('Creating staff members...');
        const staffMembers = [
            { id: randomUUID(), name: 'Dr. Alice Smith', serviceType: 'CONSULTATION', dailyCapacity: 10 },
            { id: randomUUID(), name: 'Dr. Bob Johnson', serviceType: 'TREATMENT', dailyCapacity: 5 },
            { id: randomUUID(), name: 'Charlie Brown', serviceType: 'SUPPORT', dailyCapacity: 15 },
        ];

        for (const staff of staffMembers) {
            await sql`
        INSERT INTO staff (id, user_id, name, service_type, daily_capacity, status, updated_at)
        VALUES (${staff.id}, ${demoUserId}, ${staff.name}, ${staff.serviceType}, ${staff.dailyCapacity}, 'AVAILABLE', NOW())
      `;
        }

        // 4. Create Services
        console.log('Creating services...');
        const services = [
            { id: randomUUID(), name: 'Quick Checkup', duration: 'FIFTEEN_MINUTES', requiredStaffType: 'CONSULTATION' },
            { id: randomUUID(), name: 'Standard Consultation', duration: 'THIRTY_MINUTES', requiredStaffType: 'CONSULTATION' },
            { id: randomUUID(), name: 'Full Treatment', duration: 'SIXTY_MINUTES', requiredStaffType: 'TREATMENT' },
        ];

        for (const service of services) {
            await sql`
        INSERT INTO services (id, user_id, name, duration, required_staff_type, updated_at)
        VALUES (${service.id}, ${demoUserId}, ${service.name}, ${service.duration}, ${service.requiredStaffType}, NOW())
      `;
        }

        // 5. Create Sample Appointments
        console.log('Creating sample appointments...');
        const today = new Date().toISOString().split('T')[0];
        const appointments = [
            { id: randomUUID(), customerName: 'John Doe', serviceId: services[0].id, staffId: staffMembers[0].id, time: '09:00' },
            { id: randomUUID(), customerName: 'Jane Doe', serviceId: services[1].id, staffId: staffMembers[0].id, time: '10:00' },
            { id: randomUUID(), customerName: 'Jim Beam', serviceId: services[2].id, staffId: staffMembers[1].id, time: '11:00' },
        ];

        for (const app of appointments) {
            await sql`
        INSERT INTO appointments (id, user_id, customer_name, service_id, staff_id, appointment_date, appointment_time, duration, status, updated_at)
        VALUES (
          ${app.id}, 
          ${demoUserId}, 
          ${app.customerName}, 
          ${app.serviceId}, 
          ${app.staffId}, 
          ${today}, 
          ${app.time}, 
          30, 
          'SCHEDULED', 
          NOW()
        )
      `;
        }

        console.log('✅ Seeding completed successfully!');
        console.log(`
Demo Credentials:
Email: ${demoEmail}
Password: ${demoPassword}
    `);
    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

seed();
