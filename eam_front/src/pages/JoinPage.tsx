import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useAuth } from '../auth/useAuth';
import { BrandMark } from '../ui/BrandMark';

/** Join a household with an invite code. */
export default function JoinPage() {
  const { code } = useParams();
  const inviteCode = code ?? '';
  const navigate = useNavigate();
  const { isLoading, isAuthenticated, register, refreshUser } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-4">
        <p className="text-ink">Loading…</p>
      </div>
    );
  }

  const handleJoin = async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await axios.post('/api/households/join', { code: inviteCode });
      await refreshUser();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't join the household."));
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await register(email, password, inviteCode);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't create the account."));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-sm">
        <BrandMark />
        <h1 className="text-xl font-semibold text-ink">Join a household</h1>
        <p className="mt-2 text-muted">
          <span>Invite code</span>{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-sm text-ink">
            {inviteCode}
          </code>
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink"
          >
            {error}
          </p>
        ) : null}

        {isAuthenticated ? (
          <button
            type="button"
            onClick={handleJoin}
            disabled={isSubmitting}
            className="mt-6 w-full rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-page hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Join household
          </button>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="join-email" className="block text-sm font-medium text-ink">
                  Email
                </label>
                <input
                  id="join-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="join-password" className="block text-sm font-medium text-ink">
                  Password
                </label>
                <input
                  id="join-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-page hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Create account and join
              </button>
            </form>

            <Link
              to="/login"
              state={{ from: { pathname: `/join/${inviteCode}` } }}
              className="mt-6 block text-center text-sm font-medium text-accent hover:underline"
            >
              Sign in with an existing account
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
