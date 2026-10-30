import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ImagesService, imagePrefix } from './images.service';

const R2_ENV = { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'img' };
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('ImagesService', () => {
  it('answers 503 when R2 is not configured', async () => {
    for (const name of Object.keys(R2_ENV)) delete process.env[name];
    await expect(new ImagesService().uploadUrl('avatar', 'auth0|u1')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it('presigns a PUT under the owner prefix without touching the network', async () => {
    Object.assign(process.env, R2_ENV);
    const { uploadUrl, key } = await new ImagesService().uploadUrl('avatar', 'auth0|u1');
    expect(key.startsWith(imagePrefix('avatar', 'auth0|u1'))).toBe(true);
    expect(key.endsWith('.webp')).toBe(true);
    expect(uploadUrl).toContain('acc.r2.cloudflarestorage.com');
    expect(uploadUrl).toContain('X-Amz-Signature=');
    // A checksum baked into the URL would be of an empty body and make R2 reject the real upload.
    expect(uploadUrl.toLowerCase()).not.toContain('checksum');
  });

  it("rejects a key outside the caller's prefix before saving anything", async () => {
    Object.assign(process.env, R2_ENV);
    const save = jest.fn();
    const foreign = `${imagePrefix('avatar', 'someone-else')}0b0b0b0b-0b0b-0b0b-0b0b-0b0b0b0b0b0b.webp`;
    await expect(new ImagesService().swap('avatar', 'u1', foreign, null, save)).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(new ImagesService().swap('cover', 'u1', 42 as unknown as string, null, save)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('clears with a null key even when storage is not configured', async () => {
    for (const name of Object.keys(R2_ENV)) delete process.env[name];
    const save = jest.fn().mockResolvedValue({ avatarKey: null });
    await expect(new ImagesService().swap('avatar', 'u1', null, 'u/x/old.webp', save)).resolves.toEqual({
      avatarKey: null,
    });
    expect(save).toHaveBeenCalled();
  });
});
