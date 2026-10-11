import { useEffect, useState } from 'react';
import axios from '../lib/apiClient';
import { extractErrorMessage } from '../lib/errors';
import { ageText } from '../shell/age';
import { Button } from '../ui';
import { CopyButton } from '../ui/CopyButton';
import { Dialog } from '../ui/Dialog';
import type { ServerStatus } from './types';

/** The server agent's token, for the owner: made here, shown once. */
export default function ServerAgentSetup({ now = Date.now }: { now?: () => number }) {
  const [agent, setAgent] = useState<ServerStatus['agent'] | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    axios
      .get<ServerStatus>('/api/server/status')
      .then(({ data }) => {
        if (!cancelled) setAgent(data.agent);
      })
      .catch((e) => {
        if (!cancelled) setError(extractErrorMessage(e, 'Couldn’t load the agent’s state.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const makeToken = async () => {
    setError('');
    try {
      const { data } = await axios.post<{ token: string }>('/api/server/agent/token');
      setToken(data.token);
      setAgent({ configured: true, lastSeenAt: null });
    } catch (e) {
      setError(extractErrorMessage(e, 'Couldn’t make a token.'));
    }
  };

  const settings = token ? `SERVER_AGENT_URL=${window.location.origin}\nSERVER_AGENT_TOKEN=${token}` : '';

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-[18px]">
      <h2 className="text-[15px] font-semibold">Server agent</h2>
      <p className="mt-1 text-[13px] text-muted">Reports the host the app runs on to the Server page, once a minute.</p>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-sm text-crit-ink">
          {error}
        </p>
      )}
      {agent && (
        <>
          <p className="mt-3 text-sm">
            {!agent.configured
              ? 'Not set up yet.'
              : agent.lastSeenAt
                ? `Last report ${ageText(now() - Date.parse(agent.lastSeenAt))} ago`
                : 'No report yet.'}
          </p>
          <Button size="sm" className="mt-3" onClick={() => (agent.configured ? setAsking(true) : void makeToken())}>
            {agent.configured ? 'New agent token' : 'Make agent token'}
          </Button>
        </>
      )}
      {token && (
        <section aria-label="Agent settings" className="mt-4 rounded-xl border border-warn-line bg-warn-bg p-4 text-sm text-warn-ink">
          <p>
            Put these in the server agent&apos;s <code>.env</code>. The token is shown only once; if it is lost, make a new one.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-xs text-ink">{settings}</pre>
          <div className="mt-3 flex gap-2">
            <CopyButton text={settings} />
            <Button size="sm" onClick={() => setToken(null)}>
              Done
            </Button>
          </div>
        </section>
      )}
      <Dialog
        open={asking}
        title="Make a new agent token?"
        onClose={() => setAsking(false)}
        actions={
          <>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setAsking(false);
                void makeToken();
              }}
            >
              Make a new token
            </Button>
          </>
        }
      >
        The agent stops reporting until it uses the new one.
      </Dialog>
    </section>
  );
}
