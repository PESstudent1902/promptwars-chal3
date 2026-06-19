@echo off
echo Pushing EcoScore extension to GitHub repository promptwars-chal3...
"%TEMP%\MinGit\cmd\git.exe" push -u origin main
if %ERRORLEVEL% neq 0 (
    echo.
    echo Push failed. Please make sure you have permission to push to the repository.
) else (
    echo.
    echo Push completed successfully!
)
pause
