from django.shortcuts import render

# Home page view
def home(request):
    return render(request, 'core/home.html')


def access_denied(request):
    """Render role-based access denied page."""
    return render(
        request,
        'core/access_denied.html',
        {
            'required_role': '',
            'denied_message': 'You do not have permission to view this page.',
        },
        status=403,
    )

