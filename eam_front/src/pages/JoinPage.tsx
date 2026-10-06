import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { useAuth } from '../auth/useAuth';

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
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-950">
        <p className="text-gray-900 dark:text-gray-100">Loading…</p>
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
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-gray-50 p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Join a household</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          <span>Invite code</span>{' '}
          <code className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-sm text-gray-900 dark:bg-gray-800 dark:text-gray-100">
            {inviteCode}
          </code>
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-gray-300 bg-gray-200 px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            {error}
          </p>
        ) : null}

        {isAuthenticated ? (
          <button
            type="button"
            onClick={handleJoin}
            disabled={isSubmitting}
            className="mt-6 w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
          >
            Join household
          </button>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="join-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Email
                </label>
                <input
                  id="join-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-gray-400 dark:focus:ring-gray-400"
                />
              </div>

              <div>
                <label htmlFor="join-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Password
                </label>
                <input
                  id="join-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-gray-400 dark:focus:ring-gray-400"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-gray-100 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
              >
                Create account and join
              </button>
            </form>

            <Link
              to="/login"
              state={{ from: { pathname: `/join/${inviteCode}` } }}
              className="mt-4 block text-sm text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              Sign in with an existing account
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
