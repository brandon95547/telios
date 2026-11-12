import { GOALS, GOAL_GROUPS, goalOf, type Goal, type RestyleOptions } from '@telios/shared';

type Group = keyof typeof GOAL_GROUPS;

/** What to make, in two choices: copy what is there or make something new, then which result, named as what goes in and what comes out.
 * The chosen result says what it gives, how long it takes and what it costs. */
export function GoalPicker({ options, choose }: { options: RestyleOptions; choose: (g: Goal) => void }) {
  const now = goalOf(options) ?? GOALS[0];
  const pick = (id: string) => choose(GOALS.find((g) => g.id === id)!);
  return (
    <div className="goal-picker">
      <label className="field">
        <div className="label">Start from</div>
        {/* a new group starts on its first result */}
        <select value={now.group} onChange={(e) => pick(GOALS.find((g) => g.group === (e.target.value as Group))!.id)}>
          {(Object.keys(GOAL_GROUPS) as Group[]).map((group) => <option key={group} value={group}>{GOAL_GROUPS[group]}</option>)}
        </select>
      </label>
      <label className="field">
        <div className="label">Make</div>
        <select value={now.id} onChange={(e) => pick(e.target.value)}>
          {GOALS.filter((g) => g.group === now.group).map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <div className="sub">{now.line}</div>
        <span className="goal-badges">
          <i>{now.gives}</i><i>{now.speed}</i><i className={now.cost === 'Free' ? 'free' : 'paid'}>{now.cost}</i>
        </span>
      </label>
    </div>
  );
}
