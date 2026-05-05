import cloudinary from '../config/cloudinary';
import { getMediaUrl, downloadMedia } from './whatsapp';

export async function uploadScreenshot(
  mediaId: string,
  folder: string
): Promise<string> {
  // Step 1: Get the download URL from Meta
  const mediaUrl = await getMediaUrl(mediaId);
  
  // Step 2: Download the actual file
  const buffer = await downloadMedia(mediaUrl);

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:          `adswap/${folder}`,
        resource_type:   'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation:  [{ quality: 'auto', fetch_format: 'auto' }],
        exif: false,
      },
      (error, result) => {
        if (error || !result) {
          console.error('Cloudinary upload error:', error);
          return reject(error || new Error('Upload failed'));
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

export async function deleteScreenshot(url: string): Promise<void> {
  // Extract public_id from URL
  const parts    = url.split('/');
  const filename = parts[parts.length - 1].split('.')[0];
  const folder   = parts[parts.length - 2];
  const publicId = `adswap/${folder}/${filename}`;

  await cloudinary.uploader.destroy(publicId).catch(console.error);
}