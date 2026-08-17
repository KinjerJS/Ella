/**
 * The failure of the last thing you asked for, shown where you asked for it.
 *
 * A toast would be wrong for these: unlike a confirmation, a failure often names something
 * that still needs fixing on this page, and it should stay until it is read. But "stays"
 * had become "stays forever" — the message outlived the state it described, sitting in red
 * above an entry it no longer had anything to do with.
 *
 * So it can always be closed, and the pages that own one clear it when the thing it was
 * about changes. A banner that cannot be dismissed is an assertion; this is a report.
 */

import { useI18n } from '../i18n.tsx';
import { Icon } from './Icon.tsx';

interface Props {
  /** Null renders nothing, so callers can hand over their error state directly. */
  message: string | null;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  const { t } = useI18n();
  if (!message) return null;

  return (
    <div className="warning error">
      <Icon name="alert" size={16} />
      <div>{message}</div>
      <button
        className="warning-close"
        onClick={onDismiss}
        aria-label={t('common.dismiss')}
        title={t('common.dismiss')}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
