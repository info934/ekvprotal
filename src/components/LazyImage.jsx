import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { ImageOff } from 'lucide-react';

const LazyImage = ({
  src,
  alt,
  className,
  srcSet,
  sizes,
  placeholder,
  onLoad,
  threshold = 0.1,
  ...props
}) => {
  const [isInView, setIsInView] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    // Check if IntersectionObserver is supported
    if (!('IntersectionObserver' in window)) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      });
    }, {
      rootMargin: '50px', // Start loading slightly before it comes into view
      threshold
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      }
    };
  }, [threshold]);

  const handleImageLoad = (e) => {
    setIsLoaded(true);
    if (onLoad) {
      onLoad(e);
    }
  };

  const handleError = () => {
    setHasError(true);
    setIsLoaded(true); // Stop loading state
  };

  return (
    <div 
      ref={containerRef} 
      className={cn("relative overflow-hidden bg-muted/10", className)}
      {...props}
    >
      {/* Skeleton / Placeholder */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse z-10">
          {placeholder ? (
            placeholder
          ) : (
            <div className="w-full h-full bg-slate-200 dark:bg-slate-800" />
          )}
        </div>
      )}

      {/* Error State */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 text-muted-foreground p-2 z-10">
          <ImageOff className="w-8 h-8 mb-1 opacity-50" />
          <span className="text-[10px] text-center">Obrázek nedostupný</span>
        </div>
      )}

      {/* Actual Image */}
      {isInView && !hasError && (
        <img
          src={src}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt || ''}
          onLoad={handleImageLoad}
          onError={handleError}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-500 ease-in-out block",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
};

export default LazyImage;