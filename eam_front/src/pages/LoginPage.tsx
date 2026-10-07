import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { extractErrorMessage } from '../lib/errors';
import { BrandMark } from '../ui/BrandMark';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      // AuthContext's route guards send an already-authenticated user
      // wherever they belong on the next render; if this page was reached
      // via a redirect from a protected route, prefer sending them back
      // to where they were headed.
      const redirectTo =
        (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ??
        '/dashboard';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, 'Could not sign in — please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-sm">
        <BrandMark />
        <h1 className="text-xl font-semibold text-ink">
          Sign in to EAM
        </h1>
        <p className="mt-1 text-sm text-muted">
          Monitor your inverter and battery bank.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-ink"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-ink"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-crit-bg px-3 py-2 text-sm text-crit-ink">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-page transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Don't have an account?{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
