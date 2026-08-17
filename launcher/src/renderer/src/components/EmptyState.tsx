/**
 * What a list shows before it has anything in it.
 *
 * An empty list is the moment a user is most likely to be stuck, so it is the worst place
 * to print "nothing here" and stop. Each one names what is missing, says why it matters,
 * and carries the button that fixes it — the same button they would otherwise have to go
 * find on another tab.
 */

import { Icon, type IconName } from './Icon.tsx';

interface Props {
  icon: IconName;
  title: string;
  text?: string;
  action?: {
    label: string;
    icon?: IconName;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, text, action }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon name={icon} size={22} />
      </div>
      <div className="empty-state-title">{title}</div>
      {text && <div className="empty-state-text">{text}</div>}
      {action && (
        <button className="primary" onClick={action.onClick}>
          {action.icon && <Icon name={action.icon} />}
          {action.label}
        </button>
      )}
    </div>
  );
}
