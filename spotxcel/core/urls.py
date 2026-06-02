from django.urls import path
from . import views

urlpatterns = [
    path('', views.home, name='home'),
    path('access-denied/', views.access_denied, name='access_denied'),
]