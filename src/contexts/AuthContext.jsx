import { createContext, useContext } from 'react';

// Presentation-only context: importing a view must not initialize a backend client.
export const AuthContext = createContext(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
