import { Page, Heading, Text, Stats, Stat, Chart, List, Tabs } from '@boostkit/panels'
import type { PanelContext } from '@boostkit/panels'
import { Article } from '../../../Models/Article.js'
import { User }    from '../../../Models/User.js'

export class ReportsPage extends Page {
  static slug  = 'reports/:id?'
  static label = 'Reports'
  static icon  = 'bar-chart-3'

  static async schema({ params }: PanelContext) {
    return [
      Heading.make('Reports'),
      Heading.make(`number #${params.id}`),
      Text.make('Content and user analytics.'),

      Stats.make([
        Stat.make('Total Articles').value(await Article.query().count()),
        Stat.make('Total Users').value(await User.query().count()),
      ]),

      Tabs.make()
        .tab('Content',
          Chart.make('Articles per Month')
            .chartType('bar')
            .labels(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
            .datasets([
              { label: 'Published', data: [3, 7, 5, 12, 8, 15] },
              { label: 'Drafts', data: [2, 4, 3, 5, 2, 6] },
            ]),
        )
        .tab('Traffic',
          Chart.make('Weekly Visitors')
            .chartType('area')
            .labels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
            .datasets([{ label: 'Visitors', data: [120, 230, 180, 350, 290, 150, 90] }]),
        )
        .tab('Links',
          List.make('Useful Resources')
            .items([
              { label: 'Google Analytics', href: 'https://analytics.google.com', icon: '📊' },
              { label: 'Search Console', href: 'https://search.google.com/search-console', icon: '🔍' },
            ]),
        ),
    ]
  }
}
