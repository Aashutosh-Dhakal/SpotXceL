from django.shortcuts import render

# Home page view
def home(request):
    return render(request, 'core/home.html')

