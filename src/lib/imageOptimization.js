/**
 * Image Optimization Utility
 * Provides tools for:
 * 1. Client-side image compression and conversion (WebP) before upload
 * 2. Generating optimized URLs and srcSets for display (Supabase Storage & Unsplash)
 * 3. Standardized props for lazy loading
 */

// --- Constants ---
const DEFAULT_QUALITY = 0.8;
const DEFAULT_MAX_WIDTH = 1920;
const DEFAULT_FORMAT = 'image/webp';
const DEFAULT_BREAKPOINTS = [640, 768, 1024, 1280, 1536];

/**
 * 1. Client-side Compression & Conversion
 * Compresses an image file, converts it to WebP, and resizes it if necessary.
 * Useful for processing user uploads before sending them to the server.
 * 
 * @param {File} file - The original file object
 * @param {Object} options - Configuration options
 * @param {number} [options.maxWidth=1920] - Maximum width in pixels
 * @param {number} [options.quality=0.8] - Quality (0 to 1)
 * @param {string} [options.format='image/webp'] - Output MIME type
 * @returns {Promise<File>} The optimized file
 */
export async function optimizeImageFile(file, { 
  maxWidth = DEFAULT_MAX_WIDTH, 
  quality = DEFAULT_QUALITY, 
  format = DEFAULT_FORMAT 
} = {}) {
  return new Promise((resolve, reject) => {
    // Validate input
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Invalid file type. Please provide an image.'));
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      
      img.onload = () => {
        // Calculate new dimensions
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Draw image
        ctx.drawImage(img, 0, 0, width, height);
        
        // Export
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Image compression failed'));
              return;
            }
            
            // Create new File object with correct extension
            const extension = format.split('/')[1];
            const fileName = file.name.substring(0, file.name.lastIndexOf('.')) + '.' + extension;
            
            const optimizedFile = new File([blob], fileName, {
              type: format,
              lastModified: Date.now(),
            });
            
            resolve(optimizedFile);
          },
          format,
          quality
        );
      };
      
      img.onerror = (err) => reject(err);
    };
    
    reader.onerror = (err) => reject(err);
  });
}

/**
 * 2. Optimized URL Generation
 * Generates an optimized URL for supported image services (Supabase, Unsplash).
 * Handles resizing, format conversion (WebP), and quality adjustment via URL parameters.
 * 
 * @param {string} url - Base image URL
 * @param {number} width - Target width
 * @param {Object} options - Additional options
 * @param {number} [options.quality=80] - Quality (0-100)
 * @param {string} [options.format='webp'] - Target format
 * @returns {string} Optimized URL
 */
export function getOptimizedImageUrl(url, width, { quality = 80, format = 'webp' } = {}) {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;

  // Supabase Storage Handling
  // Transforms /object/public/ to /render/image/public/ for on-the-fly transformations
  if (url.includes('supabase.co/storage/v1/object/public')) {
    const baseUrl = url.replace('/object/public', '/render/image/public');
    const params = new URLSearchParams();
    if (width) params.append('width', width);
    if (quality) params.append('quality', quality);
    if (format) params.append('format', format);
    // Add existing query params if any
    if (url.includes('?')) {
       // Simple merge might be needed if original url had token, but public urls usually don't
    }
    return `${baseUrl}?${params.toString()}`;
  }

  // Unsplash Handling
  if (url.includes('images.unsplash.com')) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}w=${width}&q=${quality}&fm=${format}&fit=max`;
  }

  // Default: Return original URL if provider is not recognized
  return url;
}

/**
 * 3. srcSet Generation
 * Generates a standard srcset string for responsive images.
 * 
 * @param {string} url - Base image URL
 * @param {Array<number>} [breakpoints] - Array of widths
 * @returns {string} srcSet string
 */
export function generateSrcSet(url, breakpoints = DEFAULT_BREAKPOINTS) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return '';

  return breakpoints
    .map(width => {
      const optimizedUrl = getOptimizedImageUrl(url, width);
      // Skip if optimization didn't change anything (provider not supported)
      if (optimizedUrl === url) return null;
      return `${optimizedUrl} ${width}w`;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * 4. Lazy Loading & Image Props Helper
 * Returns a set of props for an <img> element including src, srcSet, and lazy loading attributes.
 * 
 * @param {Object} props - Input props
 * @param {string} props.src - Base image URL
 * @param {string} [props.sizes] - HTML sizes attribute
 * @param {string} [props.alt] - Alt text
 * @param {string} [props.className] - CSS class
 * @returns {Object} Props object ready for spreading onto an <img> tag
 */
export function getImageProps({ src, sizes = '100vw', alt = '', className, ...rest }) {
  const isOptimizable = src && !src.startsWith('data:') && !src.startsWith('blob:');
  
  // Use a sensible default width for the main src (fallback)
  const fallbackSrc = isOptimizable ? getOptimizedImageUrl(src, 1200) : src;
  const srcSet = isOptimizable ? generateSrcSet(src) : undefined;

  return {
    src: fallbackSrc,
    srcSet,
    sizes,
    alt,
    loading: 'lazy',
    decoding: 'async',
    className,
    ...rest
  };
}

/**
 * 5. Background Image Optimizer
 * Returns a style object for background images with optimization.
 * Note: background-image doesn't support srcset, so we choose a reasonably large width.
 * 
 * @param {string} url - Base image URL
 * @param {number} [width=1920] - Target width
 * @returns {Object} Style object
 */
export function getBackgroundImageStyle(url, width = 1920) {
  if (!url) return {};
  const optimizedUrl = getOptimizedImageUrl(url, width);
  return {
    backgroundImage: `url('${optimizedUrl}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  };
}