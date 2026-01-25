import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService) { }

  async findById(id: string) {
    const [user] = await this.db.query`
      SELECT id, email, first_name as "firstName", last_name as "lastName", created_at as "createdAt"
      FROM users
      WHERE id = ${id}
    `;

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      fullName: `${user.firstName} ${user.lastName}`,
    };
  }

  async findByEmail(email: string) {
    const [user] = await this.db.query`
      SELECT id, email, first_name as "firstName", last_name as "lastName", password
      FROM users
      WHERE email = ${email}
    `;
    return user;
  }
}