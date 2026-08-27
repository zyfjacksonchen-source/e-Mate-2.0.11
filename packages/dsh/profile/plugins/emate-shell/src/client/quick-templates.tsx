import { useState } from 'react'
import css from './quick-templates.module.css'

export const OFFICE_TEMPLATES = [
  ['周报总结', '根据我提供的本周工作记录，整理一份重点清晰的周报，包含进展、结果、风险和下周计划。'],
  ['会议纪要', '根据我提供的会议内容，整理会议纪要，列出结论、待办、负责人和截止时间。'],
  ['工作计划', '根据我的目标，制定一份可执行的工作计划，按优先级列出步骤、交付物和时间节点。'],
  ['汇报大纲', '根据我提供的背景和目标，生成一份结构清晰的工作汇报大纲。'],
  ['数据分析', '分析我提供的数据，概括关键变化、异常、可能原因和可执行建议。'],
  ['方案撰写', '根据我的需求，撰写一份完整方案，包含目标、现状、策略、执行步骤、风险和验收标准。'],
  ['邮件起草', '根据我提供的收件人、目的和要点，起草一封专业、简洁、可直接发送的邮件。'],
  ['文档润色', '在不改变事实和原意的前提下，润色我提供的文档，使表达更清晰、专业、自然。'],
  ['表格整理', '根据我提供的信息，设计一份便于填写、筛选和汇总的表格结构。'],
  ['PPT 结构', '根据我的主题和受众，规划一份逐页 PPT 结构，说明每页核心信息和建议素材。'],
  ['项目复盘', '根据项目过程和结果，整理复盘，区分目标、结果、有效做法、问题根因和改进动作。'],
  ['头脑风暴', '围绕我提供的问题提出多种可行思路，说明各自价值、限制和优先验证方式。'],
] as const

interface Props {
  prepareDraft: (prompt: string) => void | Promise<void>
}

export function QuickTemplates({ prepareDraft }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async (name: string, prompt: string) => {
    if (busy !== null) return
    setBusy(name)
    setError(null)
    try {
      await prepareDraft(prompt)
      document.querySelector<HTMLTextAreaElement>("[data-slot='conversation.composer.bar'] textarea")?.focus()
    } catch {
      setError('模板暂时无法写入输入框，请重试。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={css.templates} aria-labelledby="emate-quick-templates-title" data-emate-quick-templates="">
      <header>
        <div><h2 id="emate-quick-templates-title">办公快速模板</h2><p>选择后只会填入草稿，你可以继续编辑。</p></div>
        <span>12 个模板</span>
      </header>
      <div className={css.grid}>
        {OFFICE_TEMPLATES.map(([name, prompt], index) => (
          <button
            key={name}
            type="button"
            disabled={busy !== null}
            aria-busy={busy === name}
            onClick={() => { void choose(name, prompt) }}
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <strong>{name}</strong>
            <small>{prompt}</small>
          </button>
        ))}
      </div>
      {error ? <p className={css.error} role="alert">{error}</p> : null}
    </section>
  )
}
