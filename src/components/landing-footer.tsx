export function LandingFooter() {
  return (
    <footer className="border-t bg-muted/20 py-8 mt-auto">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
          <div className="flex flex-col items-center md:items-start gap-1">
            <p className="font-medium text-foreground">Planar Nexus</p>
            <p>A generic card game platform</p>
          </div>
          
          <div className="flex flex-col items-center md:items-end gap-1">
            <p>Planar Nexus is a generic card game platform</p>
            <a
              href="https://company.wizards.com/en/legal"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Legal Notice
            </a>
          </div>
        </div>
        
        <div className="mt-4 pt-4 border-t text-center text-xs text-muted-foreground">
          <p>This project is for educational and entertainment purposes only.</p>
        </div>
      </div>
    </footer>
  );
}
