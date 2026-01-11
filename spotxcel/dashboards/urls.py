from django.urls import path
from . import views

urlpatterns = [
    path('parking-monitoring/', views.parking_monitoring, name='parking_monitoring'),
    path('user-management/', views.user_management, name='user_management'),
    path('parking-records/', views.parking_records, name='parking_records'),
]
