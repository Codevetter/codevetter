import { memo, useMemo } from 'react';

import {
  cliAgentModelHint,
  COMMAND_CODE_DEFAULT_MODEL,
  COMMAND_CODE_MODEL_CATALOG,
  commandCodeModelGroups,
  isCommandCodeAgent,
} from '@/lib/cli-agents';

type UnpackModelFieldProps = {
  agent: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/** Model picker for unpack synthesis — static Command Code catalog (no CLI spawn). */
export const UnpackModelField = memo(function UnpackModelField({
  agent,
  value,
  onChange,
  disabled,
}: UnpackModelFieldProps) {
  const commandCodeGroups = useMemo(() => commandCodeModelGroups(), []);
  const catalogIds = useMemo(() => new Set(COMMAND_CODE_MODEL_CATALOG.map((row) => row.id)), []);
  const customModel = value.trim() && !catalogIds.has(value.trim()) ? value.trim() : null;

  if (!isCommandCodeAgent(agent)) {
    const hint = cliAgentModelHint(agent);
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={hint.placeholder}
        title={hint.examples}
        className="h-7 w-36 rounded border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 font-mono text-xs text-slate-200 placeholder:text-slate-600"
      />
    );
  }

  const selectValue = customModel ?? (value.trim() || COMMAND_CODE_DEFAULT_MODEL);

  return (
    <select
      value={selectValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title="Command Code models"
      className="h-7 max-w-[16rem] rounded border border-[var(--cv-line)] bg-[var(--bg-raised)] px-2 font-mono text-xs text-slate-200"
    >
      {customModel ? <option value={customModel}>{customModel} (custom)</option> : null}
      <option value={COMMAND_CODE_DEFAULT_MODEL}>{COMMAND_CODE_DEFAULT_MODEL} (default)</option>
      {commandCodeGroups.map(({ group, models }) => (
        <optgroup key={group} label={group}>
          {models
            .filter((row) => row.id !== COMMAND_CODE_DEFAULT_MODEL)
            .map((row) => (
              <option key={row.id} value={row.id} title={row.description}>
                {row.id}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
});
