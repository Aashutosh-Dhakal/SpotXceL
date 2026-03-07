from django.urls import path
from . import views

urlpatterns = [
    path('parking-monitoring/', views.parking_monitoring, name='parking_monitoring'),
    path('api/license-plate/frame/', views.process_entry_frame, name='process_entry_frame'),
    path('api/parking-space/frame/', views.process_parking_frame, name='process_parking_frame'),
    path('user-management/', views.user_management, name='user_management'),
    path('user-management/edit/<int:user_id>/', views.edit_user, name='edit_user'),
    path('user-management/delete/<int:user_id>/', views.delete_user, name='delete_user'),
    path('parking-records/', views.parking_records, name='parking_records'),
    path('user-dashboard/', views.user_dashboard, name='user_dashboard'),
]
