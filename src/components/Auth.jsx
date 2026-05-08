import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { 
  ArrowLeft, Mail, Lock, User, Eye, EyeOff, Shield, 
  CheckCircle, AlertCircle, Loader2, Sparkles, Zap,
  Building2, Users, Target, BarChart3
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';

// In-file UI Components
const Card = ({ children, className, ...props }) => (
  <div className={cn("bg-white border rounded-xl shadow-sm", className)} {...props}>
    {children}
  </div>
);

const CardContent = ({ children, className, ...props }) => (
  <div className={cn("p-6", className)} {...props}>
    {children}
  </div>
);

const CardHeader = ({ children, className, ...props }) => (
  <div className={cn("px-6 py-4 border-b", className)} {...props}>
    {children}
  </div>
);

const CardTitle = ({ children, className, ...props }) => (
  <h3 className={cn("text-lg font-semibold", className)} {...props}>
    {children}
  </h3>
);

const Badge = ({ children, variant = "default", className, ...props }) => {
  const variants = {
    default: "bg-blue-100 text-blue-800 border-blue-200",
    secondary: "bg-gray-100 text-gray-800 border-gray-200",
    success: "bg-green-100 text-green-800 border-green-200",
    warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
    danger: "bg-red-100 text-red-800 border-red-200",
    info: "bg-blue-100 text-blue-800 border-blue-200"
  };
  
  return (
    <span 
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

const FeatureCard = ({ icon: Icon, title, description, className, ...props }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -4, scale: 1.02 }}
    className={cn(
      "group bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-6 cursor-pointer hover:bg-white/20 transition-all duration-200",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-3 mb-3">
      <div className="p-2 bg-white/20 rounded-lg">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <h3 className="font-semibold text-white">{title}</h3>
    </div>
    <p className="text-white/80 text-sm">{description}</p>
  </motion.div>
);

const formVariants = {
  initial: {
    opacity: 0,
    y: 20
  },
  animate: {
    opacity: 1,
    y: 0
  },
  exit: {
    opacity: 0,
    y: -20
  },
  transition: {
    duration: 0.3
  }
};

const GoogleIcon = () => (
  <svg className="w-5 h-5 mr-2" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12s5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571l6.19,5.238C42.021,35.596,44,30.138,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
  </svg>
);

const MicrosoftIcon = () => (
    <svg className="w-5 h-5 mr-2" viewBox="0 0 21 21">
        <path fill="#f25022" d="M1 1h9v9H1z"/>
        <path fill="#00a4ef" d="M1 11h9v9H1z"/>
        <path fill="#7fba00" d="M11 1h9v9h-9z"/>
        <path fill="#ffb900" d="M11 11h9v9h-9z"/>
    </svg>
);


const LoginForm = ({
  onSwitchToSignup,
  onSwitchToReset,
  onSubmit,
  onSocialLogin,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null);
  
  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    await onSubmit(email, password);
    setLoading(false);
  };

  const handleSocialLogin = async (provider) => {
    setSocialLoading(provider);
    await onSocialLogin(provider);
    setSocialLoading(null);
  };
  
  return (
    <motion.div {...formVariants} className="w-full">
      <Card className="shadow-lg border border-gray-200 bg-white">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="flex flex-col items-center gap-4 mb-6">
              <div className="p-3 bg-gray-100 rounded-xl">
                <Shield className="w-8 h-8 text-gray-700" />
              </div>
              <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900">Vítejte zpět!</h2>
                <p className="text-gray-600">Přihlaste se do svého účtu</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email
                </Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  required 
                  placeholder="vas@email.cz"
                  className="h-12 text-base"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="password" className="text-sm font-medium flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    Heslo
                  </Label>
                  <Button 
                    variant="link" 
                    type="button" 
                    onClick={onSwitchToReset} 
                    className="text-primary h-auto p-0 text-sm hover:text-primary/80"
                  >
                    Zapomněli jste heslo?
                  </Button>
                </div>
                <div className="relative">
                  <Input 
                    id="password" 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    required 
                    placeholder="••••••••"
                    className="h-12 text-base pr-12"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-12 px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-base shadow-md hover:shadow-lg transition-all duration-200" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Přihlašování...
                </>
              ) : (
                <>
                  <Shield className="w-5 h-5 mr-2" />
                  Přihlásit se
                </>
              )}
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-4 text-muted-foreground font-medium">Nebo pokračovat s</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button 
                variant="outline" 
                type="button" 
                onClick={() => handleSocialLogin('google')} 
                disabled={!!socialLoading}
                className="h-12 border-gray-200 hover:bg-gray-50"
              >
                {socialLoading === 'google' ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <GoogleIcon />} 
                <span className="ml-2">Google</span>
              </Button>
              <Button 
                variant="outline" 
                type="button" 
                onClick={() => handleSocialLogin('azure')} 
                disabled={!!socialLoading}
                className="h-12 border-gray-200 hover:bg-gray-50"
              >
                {socialLoading === 'azure' ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <MicrosoftIcon />} 
                <span className="ml-2">Microsoft</span>
              </Button>
            </div>

            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Nemáte účet?{' '}
                <Button 
                  variant="link" 
                  onClick={onSwitchToSignup} 
                  className="text-primary font-semibold hover:text-primary/80 p-0 h-auto"
                >
                  Zaregistrujte se
                </Button>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
};
const SignupForm = ({
  onSwitchToLogin,
  onSubmit
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    await onSubmit(email, password, fullName);
    setLoading(false);
  };
  
  return (
    <motion.div {...formVariants} className="w-full">
      <Card className="shadow-lg border border-gray-200 bg-white">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="flex flex-col items-center gap-4 mb-6">
              <div className="p-3 bg-gray-100 rounded-xl">
                <User className="w-8 h-8 text-gray-700" />
              </div>
              <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900">Vytvořit nový účet</h2>
                <p className="text-gray-600">Začněte svou cestu s námi</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="full-name-signup" className="text-sm font-medium flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Jméno a příjmení
                </Label>
                <Input 
                  id="full-name-signup" 
                  type="text" 
                  value={fullName} 
                  onChange={e => setFullName(e.target.value)} 
                  required 
                  placeholder="Jan Novák"
                  className="h-12 text-base"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email-signup" className="text-sm font-medium flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email
                </Label>
                <Input 
                  id="email-signup" 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  required 
                  placeholder="vas@email.cz"
                  className="h-12 text-base"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password-signup" className="text-sm font-medium flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Heslo
                </Label>
                <div className="relative">
                  <Input 
                    id="password-signup" 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    required 
                    placeholder="••••••••"
                    className="h-12 text-base pr-12"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-12 px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-base shadow-md hover:shadow-lg transition-all duration-200" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Registrace...
                </>
              ) : (
                <>
                  <User className="w-5 h-5 mr-2" />
                  Zaregistrovat se
                </>
              )}
            </Button>

            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Máte již účet?{' '}
                <Button 
                  variant="link" 
                  onClick={onSwitchToLogin} 
                  className="text-primary font-semibold hover:text-primary/80 p-0 h-auto"
                >
                  Přihlaste se
                </Button>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
};
const ResetPasswordForm = ({
  onSwitchToLogin,
  onSubmit
}) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async e => {
    e.preventDefault();
    setLoading(true);
    await onSubmit(email);
    setLoading(false);
  };
  
  return (
    <motion.div {...formVariants} className="w-full">
      <Card className="shadow-lg border border-gray-200 bg-white">
        <CardContent className="p-8">
          <div className="text-center mb-8">
            <div className="flex flex-col items-center gap-4 mb-6">
              <div className="p-3 bg-gray-100 rounded-xl">
                <Lock className="w-8 h-8 text-gray-700" />
              </div>
              <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900">Obnovit heslo</h2>
                <p className="text-gray-600">Zadejte svůj e-mail pro obnovu</p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email-reset" className="text-sm font-medium flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email
                </Label>
                <Input 
                  id="email-reset" 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  required 
                  placeholder="vas@email.cz"
                  className="h-12 text-base"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-base shadow-md hover:shadow-lg transition-all duration-200" 
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Odesílání...
                </>
              ) : (
                <>
                  <Mail className="w-5 h-5 mr-2" />
                  Odeslat odkaz pro obnovu
                </>
              )}
            </Button>

            <div className="text-center">
              <Button 
                variant="link" 
                onClick={onSwitchToLogin} 
                className="text-primary font-semibold hover:text-primary/80 flex items-center justify-center mx-auto p-0 h-auto"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> 
                Zpět na přihlášení
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
};
const Auth = () => {
  const [view, setView] = useState('login'); // 'login', 'signup', 'reset'
  const {
    signIn,
    signUp,
    signInWithSso
  } = useAuth();
  const {
    toast
  } = useToast();
  const handleSignIn = async (email, password) => {
    const {
      error
    } = await signIn(email, password);
    if (!error) {
      toast({
        title: '✅ Přihlášení úspěšné!'
      });
    }
  };
  const handleSignUp = async (email, password, fullName) => {
    const {
      error
    } = await signUp(email, password, fullName);
    if (!error) {
      toast({
        title: '✅ Registrace úspěšná!',
        description: 'Prosím, zkontrolujte svůj e-mail pro potvrzení účtu.',
        duration: 9000
      });
      setView('login');
    }
  };
  const handlePasswordReset = async email => {
    const {
      error
    } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`
    });
    if (error) {
      toast({
        title: 'Chyba',
        description: error.message,
        variant: 'destructive'
      });
    } else {
      toast({
        title: '✅ Odesláno!',
        description: 'Zkontrolujte prosím svou e-mailovou schránku pro odkaz na obnovu hesla.',
        duration: 9000
      });
      setView('login');
    }
  };

  const handleSocialLogin = async (provider) => {
    const providerLabel = provider === 'azure' ? 'Microsoft' : 'Google';
    const { error } = await signInWithSso(provider);

    if (!error) {
      toast({
        title: `Přesměrovávám na ${providerLabel}`,
        description: 'Po ověření budete vráceni zpět do portálu.',
      });
      return;
    }

    toast({
      title: `${providerLabel} SSO není dostupné`,
      description: 'Zkontrolujte, že je provider zapnutý v Supabase Auth nastavení.',
      variant: 'destructive',
    });
  };

  return (
    <div className="w-full min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white">
      {/* Left Side - Forms */}
      <div className="flex flex-col items-center justify-center p-8 lg:p-12 relative">
        <div className="w-full max-w-md mx-auto relative z-10">
          {/* Logo Section */}
          <div className="mb-8 text-center">
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-4 mb-6"
            >
              <img 
                src="https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/71b77a994fbf9e20ce79a1c424df758b.png" 
                alt="EKV Group Logo" 
                className="h-16 w-auto" 
              />
              <div className="text-center">
                <h1 className="text-2xl font-bold text-gray-900">EKV Group</h1>
                <p className="text-sm text-gray-600 font-medium">Project Management Portal</p>
              </div>
            </motion.div>
          </div>

          {/* Forms */}
          <AnimatePresence mode="wait">
            {view === 'login' && (
              <LoginForm 
                key="login" 
                onSubmit={handleSignIn} 
                onSwitchToSignup={() => setView('signup')} 
                onSwitchToReset={() => setView('reset')} 
                onSocialLogin={handleSocialLogin} 
              />
            )}
            {view === 'signup' && (
              <SignupForm 
                key="signup" 
                onSubmit={handleSignUp} 
                onSwitchToLogin={() => setView('login')} 
              />
            )}
            {view === 'reset' && (
              <ResetPasswordForm 
                key="reset" 
                onSubmit={handlePasswordReset} 
                onSwitchToLogin={() => setView('login')} 
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right Side - Hero Section */}
      <div className="hidden lg:block relative overflow-hidden bg-gray-50">
        <img 
          className="absolute inset-0 w-full h-full object-cover opacity-20" 
          alt="Modern office interior with large windows" 
          src="https://horizons-cdn.hostinger.com/71f822ff-0858-4714-9f59-dcfbecb55c00/gemini_generated_image_6o2xfv6o2xfv6o2x-A6n0A.png" 
        />
        <div className="absolute inset-0 bg-white/80"></div>
        
        {/* Content Overlay */}
        <div className="absolute inset-0 flex flex-col justify-center p-12">
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-gray-900 space-y-8"
          >
            <div>
              <h1 className="text-5xl font-bold leading-tight mb-4 text-gray-900">
                Spravujte své projekty
                <span className="block text-gray-700">
                  efektivně
                </span>
              </h1>
              <p className="text-xl text-gray-600 max-w-md leading-relaxed">
                Všechny nástroje pro úspěšné řízení projektů na jednom místě. 
                Moderní, intuitivní a výkonné řešení pro vaši firmu.
              </p>
            </div>

            {/* Feature Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Building2 className="w-5 h-5 text-gray-700" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Projekty</h3>
                </div>
                <p className="text-gray-600 text-sm">Kompletní správa projektů s pokročilými nástroji</p>
              </div>
              <div className="bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Users className="w-5 h-5 text-gray-700" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Tým</h3>
                </div>
                <p className="text-gray-600 text-sm">Efektivní spolupráce a komunikace v týmu</p>
              </div>
              <div className="bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Target className="w-5 h-5 text-gray-700" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Úkoly</h3>
                </div>
                <p className="text-gray-600 text-sm">Organizace úkolů s Kanban přehledem</p>
              </div>
              <div className="bg-white/60 backdrop-blur-sm border border-gray-200 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <BarChart3 className="w-5 h-5 text-gray-700" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Reporty</h3>
                </div>
                <p className="text-gray-600 text-sm">Detailní analýzy a přehledy výkonnosti</p>
              </div>
            </div>

            {/* Trust Indicators */}
            <div className="flex items-center gap-6 pt-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="text-sm text-gray-600">Bezpečné</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-600" />
                <span className="text-sm text-gray-600">Rychlé</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-600" />
                <span className="text-sm text-gray-600">Moderní</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};
export default Auth;
