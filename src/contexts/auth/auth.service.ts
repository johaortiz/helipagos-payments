import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Validates credentials against env vars and returns a signed JWT.
   * Throws UnauthorizedException if credentials are invalid.
   */
  login(username: string, password: string): { accessToken: string } {
    const validUsername = this.configService.get<string>('AUTH_USERNAME');
    const validPassword = this.configService.get<string>('AUTH_PASSWORD');

    if (username !== validUsername || password !== validPassword) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const accessToken = this.jwtService.sign({ username });

    return { accessToken };
  }
}
