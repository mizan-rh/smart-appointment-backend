import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthResponseDto, LoginDto, SignupDto } from './dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private db: DatabaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) { }

  /* -------------------- SIGNUP -------------------- */
  async signup(dto: SignupDto): Promise<AuthResponseDto> {
    const existingUsers = await this.db.query`
      SELECT * FROM users WHERE email = ${dto.email}
    `;

    if (existingUsers.length > 0) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const [user] = await this.db.query`
      INSERT INTO users (id, email, password, first_name, last_name, updated_at)
      VALUES (${randomUUID()}, ${dto.email}, ${hashedPassword}, ${dto.firstName}, ${dto.lastName}, NOW())
      RETURNING *
    `;

    const { accessToken, refreshToken } = await this.generateTokens(user.id);
    await this.storeRefreshToken(user.id, refreshToken);

    this.logger.log(`New user registered: ${user.email}`);

    return {
      accessToken,
      refreshToken,
      user: this.mapUserToResponse(user),
    };
  }

  /* -------------------- LOGIN -------------------- */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.validateUser(dto.email, dto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { accessToken, refreshToken } = await this.generateTokens(user.id);
    await this.storeRefreshToken(user.id, refreshToken);

    this.logger.log(`User logged in: ${user.email}`);

    return {
      accessToken,
      refreshToken,
      user: this.mapUserToResponse(user),
    };
  }

  /* -------------------- VALIDATE USER -------------------- */
  async validateUser(email: string, password: string) {
    const [user] = await this.db.query`
      SELECT * FROM users WHERE email = ${email}
    `;

    if (!user) return null;

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return null;

    return user;
  }

  /* -------------------- REFRESH ACCESS TOKEN -------------------- */
  async refreshAccessToken(
    userId: string,
    refreshToken: string,
  ): Promise<{ accessToken: string }> {
    const [storedToken] = await this.db.query`
      SELECT * FROM refresh_tokens WHERE token = ${refreshToken}
    `;

    if (
      !storedToken ||
      storedToken.is_revoked ||
      storedToken.user_id !== userId
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (new Date() > storedToken.expires_at) {
      await this.db.query`
        DELETE FROM refresh_tokens WHERE id = ${storedToken.id}
      `;
      throw new UnauthorizedException('Refresh token expired');
    }

    const accessToken = await this.generateAccessToken(userId);
    return { accessToken };
  }

  /* -------------------- LOGOUT -------------------- */
  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.db.query`
      UPDATE refresh_tokens 
      SET is_revoked = true 
      WHERE user_id = ${userId} AND token = ${refreshToken}
    `;

    this.logger.log(`User logged out: ${userId}`);
  }

  async revokeAllTokens(userId: string): Promise<void> {
    await this.db.query`
      UPDATE refresh_tokens 
      SET is_revoked = true 
      WHERE user_id = ${userId}
    `;
  }

  /* -------------------- TOKEN GENERATION -------------------- */
  private async generateTokens(userId: string) {
    const accessToken = await this.generateAccessToken(userId);
    const refreshToken = await this.generateRefreshToken(userId);
    return { accessToken, refreshToken };
  }

  private async generateAccessToken(userId: string): Promise<string> {
    const options: JwtSignOptions = {
      secret: this.configService.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.getOrThrow('JWT_ACCESS_EXPIRATION'),
    };

    return this.jwtService.signAsync({ sub: userId }, options);
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const options: JwtSignOptions = {
      secret: this.configService.getOrThrow('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.getOrThrow('JWT_REFRESH_EXPIRATION'),
    };

    return this.jwtService.signAsync({ sub: userId }, options);
  }

  /* -------------------- REFRESH TOKEN STORE -------------------- */
  private async storeRefreshToken(
    userId: string,
    token: string,
  ): Promise<void> {
    const expiresIn = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRATION',
    );
    const expiresAt = this.calculateExpiration(expiresIn);

    await this.db.query`
      INSERT INTO refresh_tokens (id, token, user_id, expires_at)
      VALUES (${randomUUID()}, ${token}, ${userId}, ${expiresAt})
    `;
  }

  private calculateExpiration(expiresIn: string): Date {
    const now = new Date();
    const match = expiresIn.match(/^(\d+)([dhms])$/);

    if (!match) {
      throw new Error('Invalid expiration format');
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'd':
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      case 'h':
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'm':
        return new Date(now.getTime() + value * 60 * 1000);
      case 's':
        return new Date(now.getTime() + value * 1000);
      default:
        throw new Error('Invalid time unit');
    }
  }

  /* -------------------- RESPONSE MAPPER -------------------- */
  private mapUserToResponse(user: any) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.first_name || user.firstName,
      lastName: user.last_name || user.lastName,
      fullName: `${user.first_name || user.firstName} ${user.last_name || user.lastName}`,
    };
  }
}
