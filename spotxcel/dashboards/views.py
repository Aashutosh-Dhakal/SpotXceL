from django.shortcuts import render, redirect


def parking_monitoring(request):
    """Display the parking lot monitoring dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    return render(request, 'dashboards/parking_monitoring.html')


def user_management(request):
    """Display the user management dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    return render(request, 'dashboards/user_management.html')


def parking_records(request):
    """Display the parking records/history dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    return render(request, 'dashboards/parking_records.html')

