import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private db: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: { sub: string }) {
    const [user] = await this.db.query`
      SELECT id, email, first_name as "firstName", last_name as "lastName"
      FROM users
      WHERE id = ${payload.sub}
    `;

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      ...user,
      fullName: `${user.firstName} ${user.lastName}`,
    };
  }
}