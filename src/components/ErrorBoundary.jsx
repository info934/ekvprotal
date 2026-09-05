import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  componentDidUpdate(previousProps) {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, errorInfo: null });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Safe check for development environment that works in Vite and avoids 'process is not defined' ESLint errors
      const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;

      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center bg-slate-50 rounded-xl border border-slate-200 m-4">
          <div className="bg-red-100 p-4 rounded-full mb-6">
            <AlertTriangle className="w-12 h-12 text-red-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Něco se pokazilo</h2>
          <p className="text-slate-600 mb-6 max-w-md">
            Omlouváme se, ale v této části aplikace došlo k neočekávané chybě. 
            Zkuste stránku obnovit.
          </p>
          
          <div className="flex gap-4">
            <Button onClick={this.handleReset} className="flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Obnovit stránku
            </Button>
            <Button variant="outline" onClick={() => window.history.back()}>
              Zpět
            </Button>
          </div>

          {isDev && this.state.error && (
            <div className="mt-8 p-4 bg-slate-900 text-slate-50 rounded-lg text-left max-w-2xl overflow-auto w-full">
              <p className="font-mono text-sm text-red-400 mb-2">{this.state.error.toString()}</p>
              <pre className="font-mono text-xs text-slate-300">
                {this.state.errorInfo?.componentStack}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
