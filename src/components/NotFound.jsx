import { ArrowLeft, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const NotFound = () => {
  const navigate = useNavigate();

  return (
    <div className="app-page flex min-h-[70vh] items-center justify-center">
      <section className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase text-primary">Chyba 404</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Stránka nebyla nalezena</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Odkaz už nemusí být platný, nebo k této části portálu nevede žádná stránka.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Zpět
          </Button>
          <Button type="button" onClick={() => navigate('/dashboard')}>
            <Home className="mr-2 h-4 w-4" /> Na přehled
          </Button>
        </div>
      </section>
    </div>
  );
};

export default NotFound;
