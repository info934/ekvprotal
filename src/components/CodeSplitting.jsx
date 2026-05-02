import React, { Suspense, useState, useEffect } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Simple Error Boundary component for handling lazy loading errors
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Lazy loading error:", error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Alert variant="destructive" className="my-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Chyba načítání komponenty</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-2">Nepodařilo se načíst požadovanou část aplikace.</p>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => {
                this.resetError();
                window.location.reload();
              }}
              className="bg-white/10 hover:bg-white/20 border-white/20"
            >
              Zkusit znovu (obnovit stránku)
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component for code splitting with advanced features.
 * 
 * @param {Function} importComponent - Function that returns the dynamic import (e.g. () => import('./MyComponent'))
 * @param {Object} options - Configuration options
 * @param {React.ReactNode} [options.fallback] - Custom loading component
 * @param {number} [options.minLoadTime=300] - Minimum loading time to prevent flashing (ms)
 * @returns {React.Component} - Wrapped component with Suspense and ErrorBoundary
 */
export const lazyLoad = (importComponent, { fallback, minLoadTime = 300 } = {}) => {
  // Create a lazy component that respects a minimum loading time
  // This prevents the "flash of loading content" for fast connections
  const LazyComponent = React.lazy(() => {
    return Promise.all([
      importComponent(),
      new Promise(resolve => setTimeout(resolve, minLoadTime))
    ]).then(([moduleExports]) => moduleExports);
  });

  // Default spinner fallback if none provided
  const DefaultFallback = () => (
    <div className="flex items-center justify-center p-8 w-full h-full min-h-[200px]">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm">Načítání...</span>
      </div>
    </div>
  );

  const LoadingFallback = fallback || DefaultFallback;

  // Return the functional component wrapper
  const LazyWrapper = (props) => {
    const [isHovered, setIsHovered] = useState(false);

    // Preload functionality
    const handleMouseEnter = () => {
      if (!isHovered) {
        setIsHovered(true);
        // Trigger the import immediately to start fetching
        try {
          const componentPromise = importComponent();
          // We don't need to do anything with the promise result here,
          // React.lazy's cache will handle it when we actually render
        } catch (e) {
          // Ignore errors during preload
        }
      }
    };

    return (
      <ErrorBoundary>
        <div onMouseEnter={handleMouseEnter} className="contents">
          <Suspense fallback={<LoadingFallback />}>
            <LazyComponent {...props} />
          </Suspense>
        </div>
      </ErrorBoundary>
    );
  };

  // Attach preload method for manual preloading
  LazyWrapper.preload = () => {
    try {
      importComponent();
    } catch (e) {
      console.warn("Preload failed:", e);
    }
  };

  return LazyWrapper;
};

/**
 * Component version for declarative usage within JSX
 */
const CodeSplitting = ({ 
  component: Component, // Already lazy loaded component or import function
  fallback, 
  children,
  ...props 
}) => {
  // Default spinner fallback
  const DefaultFallback = (
    <div className="flex items-center justify-center p-4">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  return (
    <ErrorBoundary>
      <Suspense fallback={fallback || DefaultFallback}>
        {Component ? <Component {...props} /> : children}
      </Suspense>
    </ErrorBoundary>
  );
};

export default CodeSplitting;