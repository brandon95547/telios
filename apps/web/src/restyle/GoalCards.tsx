import { GOALS, GOAL_GROUPS, goalOf, type Goal, type RestyleOptions } from '@telios/shared';

/** What to make, in the person's words: each card says what it gives, how long it takes and what it costs. */
export function GoalCards({ options, choose }: { options: RestyleOptions; choose: (g: Goal) => void }) {
  const now = goalOf(options);
  return (
    <div className="goals" role="radiogroup" aria-label="What do you want to make?">
      {(Object.keys(GOAL_GROUPS) as (keyof typeof GOAL_GROUPS)[]).map((group) => (
        <div key={group} className="goal-group">
          <div className="goal-group-title">{GOAL_GROUPS[group]}</div>
          {GOALS.filter((g) => g.group === group).map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={g.id === now?.id} className={`goal ${g.id === now?.id ? 'on' : ''}`} onClick={() => choose(g)}>
              <b>{g.label}</b>
              <span className="goal-line">{g.line}</span>
              <span className="goal-badges">
                <i>{g.gives}</i><i>{g.speed}</i><i className={g.cost === 'Free' ? 'free' : 'paid'}>{g.cost}</i>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
