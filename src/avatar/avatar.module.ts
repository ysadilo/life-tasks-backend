import { Module } from '@nestjs/common';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { BoardsModule } from '../boards/boards.module';
import { ImagesModule } from '../images/images.module';

@Module({
  imports: [BoardsModule, ImagesModule],
  controllers: [AvatarController],
  providers: [AvatarService],
})
export class AvatarModule {}
