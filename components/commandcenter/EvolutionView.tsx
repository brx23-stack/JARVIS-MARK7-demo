"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Milestone = { id: string; title: string; completed: boolean; evidence?: string };
type Goal = { id: string; title: string; description: string; category: string; status: "active" | "paused" | "completed"; targetDate?: string; milestones: Milestone[]; createdAt: string };
type Evidence = { id: string; skill: string; description: string; createdAt: string };

export default function EvolutionView() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Learning");
  const [milestones, setMilestones] = useState("");
  const [skill, setSkill] = useState("");
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/evolution", { cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 401 ? "Sign in to use Personal Evolution." : "Could not load your goals.");
    const data = await res.json();
    setGoals(Array.isArray(data.goals) ? data.goals : []);
    setEvidence(Array.isArray(data.evidence) ? data.evidence : []);
  }, []);

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [refresh]);

  const stats = useMemo(() => ({ active: goals.filter((g) => g.status === "active").length, completed: goals.filter((g) => g.status === "completed").length, milestones: goals.reduce((n, g) => n + g.milestones.filter((m) => m.completed).length, 0), total: goals.reduce((n, g) => n + g.milestones.length, 0) }), [goals]);

  async function send(body: unknown) {
    const res = await fetch("/api/evolution", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed.");
    await refresh();
  }

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await send({ action: "create_goal", title, description, category, milestones: milestones.split("\n").map((s) => s.trim()).filter(Boolean) }); setTitle(""); setDescription(""); setMilestones(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create goal."); }
    finally { setBusy(false); }
  }

  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await send({ action: "add_evidence", skill, description: proof }); setSkill(""); setProof(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save evidence."); }
    finally { setBusy(false); }
  }

  async function toggleMilestone(goal: Goal, milestone: Milestone) {
    setError("");
    try { await send({ action: "update_goal", id: goal.id, milestoneId: milestone.id, completed: !milestone.completed }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update milestone."); }
  }

  async function removeGoal(id: string) {
    if (!window.confirm("Delete this goal and its milestones?")) return;
    const res = await fetch(`/api/evolution?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) { setError("Could not delete goal."); return; }
    await refresh();
  }

  return <section className="cc-view-stack">
    <div className="cc-view-heading"><div><div className="cc-section-kicker">PERSONAL EVOLUTION</div><h2>Learn deliberately. Improve measurably.</h2><p>Track goals, milestones, and evidence of skills you have actually practised. JARVIS does not infer progress without evidence.</p></div></div>
    {error && <div className="cc-banner error">{error}</div>}
    <div className="cc-stat-grid">
      <div className="cc-panel cc-stat-card"><span>ACTIVE GOALS</span><strong>{stats.active}</strong></div>
      <div className="cc-panel cc-stat-card"><span>COMPLETED GOALS</span><strong>{stats.completed}</strong></div>
      <div className="cc-panel cc-stat-card"><span>MILESTONES</span><strong>{stats.milestones}/{stats.total}</strong></div>
      <div className="cc-panel cc-stat-card"><span>SKILL EVIDENCE</span><strong>{evidence.length}</strong></div>
    </div>
    <div className="cc-panel cc-form-panel">
      <div className="cc-panel-head"><span>CREATE A LEARNING OR DEVELOPMENT GOAL</span></div>
      <form onSubmit={createGoal} className="cc-evolution-form">
        <label>Goal title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="e.g. Build a foundation in cosmology" /></label>
        <label>Category<input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} placeholder="Learning, research, programming…" /></label>
        <label className="wide">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} placeholder="What do you want to understand or achieve?" /></label>
        <label className="wide">Milestones (one per line)<textarea value={milestones} onChange={(e) => setMilestones(e.target.value)} rows={3} placeholder={"Read an introductory chapter\nComplete a problem set\nExplain the concept in my own words"} /></label>
        <button type="submit" disabled={busy || !title.trim()}>{busy ? "SAVING…" : "ADD GOAL"}</button>
      </form>
    </div>
    <div className="cc-panel cc-form-panel">
      <div className="cc-panel-head"><span>RECORD DEMONSTRATED SKILL</span></div>
      <form onSubmit={addEvidence} className="cc-evolution-form">
        <label>Skill<input value={skill} onChange={(e) => setSkill(e.target.value)} maxLength={80} required placeholder="e.g. C++ problem solving" /></label>
        <label className="wide">Evidence<textarea value={proof} onChange={(e) => setProof(e.target.value)} maxLength={800} required rows={2} placeholder="What did you complete, build, solve, or explain?" /></label>
        <button type="submit" disabled={busy || !skill.trim() || !proof.trim()}>RECORD EVIDENCE</button>
      </form>
    </div>
    <div className="cc-panel cc-evolution-list">
      <div className="cc-panel-head"><span>YOUR GOALS</span><b>{goals.length} TOTAL</b></div>
      {!goals.length && <p className="cc-muted">No goals yet. Start with one specific outcome and a few observable milestones.</p>}
      {goals.map((goal) => <article className="cc-evolution-goal" key={goal.id}>
        <div className="cc-evolution-goal-head"><div><span>{goal.category.toUpperCase()} · {goal.status.toUpperCase()}</span><h3>{goal.title}</h3>{goal.description && <p>{goal.description}</p>}</div><button type="button" onClick={() => removeGoal(goal.id)} aria-label={`Delete ${goal.title}`}>DELETE</button></div>
        {goal.milestones.length > 0 && <div className="cc-evolution-milestones">{goal.milestones.map((milestone) => <label key={milestone.id}><input type="checkbox" checked={milestone.completed} onChange={() => toggleMilestone(goal, milestone)} /><span>{milestone.title}</span></label>)}</div>}
      </article>)}
    </div>
    <div className="cc-panel cc-evolution-list">
      <div className="cc-panel-head"><span>SKILL EVIDENCE LOG</span><b>{evidence.length} RECORDS</b></div>
      {!evidence.length && <p className="cc-muted">Record completed exercises, projects, explanations, or other observable work. Evidence is more useful than an unsupported skill score.</p>}
      {evidence.slice(0, 20).map((item) => <article className="cc-evidence-row" key={item.id}><div><strong>{item.skill}</strong><p>{item.description}</p></div><time>{new Date(item.createdAt).toLocaleDateString()}</time></article>)}
    </div>
  </section>;
}
