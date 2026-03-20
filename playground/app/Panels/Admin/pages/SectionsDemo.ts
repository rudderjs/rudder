import { Page, Heading, Text, Section, Stats, Stat, Chart, List, Table, Column, Tab, Tabs } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'

export class SectionsDemo extends Page {
  static slug  = 'sections-demo'
  static label = 'Sections Demo'
  static icon  = 'layout-panel-top'

  static async schema(_ctx: PanelContext) {
    return [
      Heading.make('Section Examples'),
      Text.make('Demonstrates Section grouping: collapsible cards, columns, descriptions, nested schema elements.'),

      // ── Basic section ──────────────────────────────────────
      Heading.make('Basic Section').level(2),
      Text.make('A simple card grouping with a title.'),

      Section.make('Overview')
        .schema(
          Stats.make([
            Stat.make('Total Articles').value(await Article.query().count()),
            Stat.make('Published').value(await Article.query().where('draftStatus', 'published').count()),
          ]),
        ),

      // ── Section with description ───────────────────────────
      Heading.make('Section with Description').level(2),
      Text.make('A section with a subtitle/description below the title.'),

      Section.make('Analytics')
        .description('Traffic and content metrics for the last 6 months.')
        .schema(
          Chart.make('Content Growth')
            .chartType('line')
            .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
            .datasets([
              { label: 'Articles', data: [5, 12, 18, 25, 33, 42] },
              { label: 'Users', data: [2, 4, 6, 8, 12, 15] },
            ]),
        ),

      // ── Collapsible section ────────────────────────────────
      Heading.make('Collapsible Section').level(2),
      Text.make('Click the header to expand/collapse. Starts expanded.'),

      Section.make('Quick Links')
        .collapsible()
        .schema(
          List.make('Resources')
            .items([
              { label: 'Documentation', description: 'Read the BoostKit docs', href: '/docs', icon: '📖' },
              { label: 'GitHub', description: 'View source code', href: 'https://github.com/boostkitjs/boostkit', icon: '🐙' },
              { label: 'Support', description: 'Get help', href: '/contact', icon: '💬' },
            ]),
        ),

      // ── Collapsed by default ───────────────────────────────
      Heading.make('Collapsed by Default').level(2),
      Text.make('This section starts collapsed. Click to reveal.'),

      Section.make('Advanced Settings')
        .description('Optional configuration — expand to see.')
        .collapsible()
        .collapsed()
        .schema(
          Text.make('These are the advanced settings that are hidden by default.'),
          Stats.make([
            Stat.make('Cache Hit Rate').value('94%'),
            Stat.make('Avg Response').value('45ms'),
          ]),
        ),

      // ── Section with table ─────────────────────────────────
      Heading.make('Section with Table').level(2),
      Text.make('A table inside a section card.'),

      Section.make('Recent Articles')
        .description('The latest 5 articles.')
        .schema(
          Table.make('Latest')
            .fromModel(Article)
            .columns([
              Column.make('title').label('Title').sortable(),
              Column.make('draftStatus').label('Status').badge(),
              Column.make('createdAt').label('Created').date(),
            ])
            .sortBy('createdAt', 'DESC')
            .limit(5),
        ),

      // ── Multiple elements in section ───────────────────────
      Heading.make('Multiple Elements in Section').level(2),
      Text.make('A section can contain multiple schema elements.'),

      Section.make('Dashboard Overview')
        .schema(
          Stats.make([
            Stat.make('Articles').value(await Article.query().count()),
            Stat.make('Published').value(await Article.query().where('draftStatus', 'published').count()).trend(12),
          ]),
          Chart.make('Monthly Articles')
            .chartType('bar')
            .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
            .datasets([
              { label: 'Published', data: [3, 7, 5, 12, 8, 15] },
              { label: 'Drafts', data: [2, 4, 3, 5, 2, 6] },
            ]),
        ),

      // ── Section with Tabs ──────────────────────────────────
      Heading.make('Section with Tabs').level(2),
      Text.make('Tabs nested inside a section card.'),

      Section.make('Content Overview')
        .description('Browse content by type.')
        .schema(
          Tabs.make('section-tabs', [
            Tab.make('Articles')
              .icon('file-text')
              .schema([
                Table.make('Recent Articles')
                  .fromModel(Article)
                  .columns([
                    Column.make('title').label('Title'),
                    Column.make('createdAt').label('Created').date(),
                  ])
                  .sortBy('createdAt', 'DESC')
                  .limit(3),
              ]),
            Tab.make('Stats')
              .icon('bar-chart')
              .schema([
                Stats.make([
                  Stat.make('Total').value(await Article.query().count()),
                  Stat.make('Published').value(await Article.query().where('draftStatus', 'published').count()),
                ]),
              ]),
            Tab.make('Chart')
              .icon('pie-chart')
              .schema([
                Chart.make('Weekly Views')
                  .chartType('area')
                  .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
                  .datasets([{ label: 'Views', data: [45, 120, 89, 200, 156, 80, 40] }]),
              ]),
          ]),
        ),
    ]
  }
}
