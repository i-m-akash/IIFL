import { ChevronRight, Shield } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/providers/AuthProvider'

export default function SettingsIndex() {
  const { user } = useAuth()
  const usersAccessHref = user ? `/${user.adminSlug}/settings/users` : '/signin'

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
    

      <Card className="border-slate-200/80 shadow-sm flex ">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Shield className="h-5 w-5 text-primary" />
            Users &amp; Access
          </CardTitle>
          <CardDescription>Roles, status, temporary passwords, and your own password are all managed here.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center items-center p-6">
          <div>
            <Button asChild className="gap-2">
              <Link to={usersAccessHref}>
                Open Users &amp; Access
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}