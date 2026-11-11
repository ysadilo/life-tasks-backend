export class SubscribeDto {
  endpoint!: string;
  keys!: { p256dh: string; auth: string };
  /** The device's UI language; push text sent here uses it. */
  language?: string;
}

export class MuteDto {
  muted!: boolean;
}

export class NotificationSettingsDto {
  enabled!: boolean;
}
