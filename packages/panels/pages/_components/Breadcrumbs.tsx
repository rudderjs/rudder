import React from 'react'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb.js'

interface Crumb {
  label: string
  href?: string
}

interface Props {
  crumbs: Crumb[]
}

export function Breadcrumbs({ crumbs }: Props) {
  return (
    <Breadcrumb className="mb-6">
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href
                ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
                : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              }
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
