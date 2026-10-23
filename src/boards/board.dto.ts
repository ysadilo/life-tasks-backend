export class CreateBoardDto {
  name!: string;
  shared?: boolean;
  /** Emails to invite; ignored for a personal board. */
  invites?: string[];
}

export class InviteDto {
  email!: string;
}
